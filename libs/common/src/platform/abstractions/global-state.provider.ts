import { GlobalState } from "../interfaces/global-state";
import { KeyDefinition } from "../state/key-definition";

export abstract class GlobalStateProvider {
  create: <T>(keyDefinition: KeyDefinition<T>) => GlobalState<T>;
}
