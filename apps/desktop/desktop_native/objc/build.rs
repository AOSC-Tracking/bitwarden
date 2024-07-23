fn main() {
    cc::Build::new()
        .file("src/native/commands/status.m")
        .file("src/native/utils.m")
        .file("src/native/autofill.m")
        .flag("-fobjc-arc") // Enable Auto Reference Counting (ARC)
        .compile("autofill");
    println!("cargo::rerun-if-changed=src/native/autofill.m");
}
