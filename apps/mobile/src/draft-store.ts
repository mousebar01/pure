import AsyncStorage from "@react-native-async-storage/async-storage";
export { draftStorageKey } from "./draft-key";

export async function loadDraft(key: string): Promise<string> {
  try {
    return await AsyncStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export async function saveDraft(key: string, value: string): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(key, value);
    else await AsyncStorage.removeItem(key);
  } catch {
    // Draft persistence must never block composing or sending a message.
  }
}
