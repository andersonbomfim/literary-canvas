import { useEffect, useState } from "react";

export type ReadingTheme = "light" | "dark";

const STORAGE_KEY = "literaryCanvas:readingTheme";

function readStoredTheme(): ReadingTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function useReadingTheme() {
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>(() =>
    readStoredTheme()
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, readingTheme);
  }, [readingTheme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setReadingTheme(event.newValue === "dark" ? "dark" : "light");
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const toggleReadingTheme = () =>
    setReadingTheme(theme => (theme === "light" ? "dark" : "light"));

  return { readingTheme, toggleReadingTheme };
}
