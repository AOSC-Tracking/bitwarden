pub mod client;
pub mod server;

/// Resolve the path to the IPC socket.
pub fn path(name: &str) -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        // Use a unique IPC pipe //./pipe/xxxxxxxxxxxxxxxxx.app.bitwarden per user.
        // Hashing prevents problems with reserved characters and file length limitations.
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use sha2::Digest;
        let home = dirs::home_dir().unwrap();
        let hash = sha2::Sha256::digest(home.as_os_str().as_encoded_bytes());
        let hash_b64 = URL_SAFE_NO_PAD.encode(hash.as_slice());

        format!(r"\\.\pipe\{hash_b64}.app.{name}").into()
    }

    #[cfg(target_os = "macos")]
    {
        let mut home = dirs::home_dir().unwrap();

        // When running in an unsandboxed environment, path is: /Users/<user>/
        // While running sandboxed, it's different: /Users/<user>/Library/Containers/com.bitwarden.desktop/Data
        //
        // We want to use App Groups in /Users/<user>/Library/Group Containers/LTZ2PFU5D6.com.bitwarden.desktop,
        // so we need to remove all the components after the user.
        // Note that we subtract 3 because the root directory is counted as a component (/, Users, <user>).
        let num_components = home.components().count();
        for _ in 0..num_components - 3 {
            debug_assert!(home.pop(), "Failed to pop a component");
        }

        home.join(format!(
            "Library/Group Containers/LTZ2PFU5D6.com.bitwarden.desktop/tmp/app.{name}"
        ))
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, we use the user's cache directory.
        let home = dirs::cache_dir().unwrap();
        let path_dir = home.join("com.bitwarden.desktop");

        // The chache directory might not exist, so create it
        let _ = std::fs::create_dir_all(&path_dir);
        path_dir.join(format!("app.{name}"))
    }
}
