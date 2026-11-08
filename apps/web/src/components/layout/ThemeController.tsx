import { useEffect } from "react";
import { useUiStore } from "@/stores/ui";

/** Applies the `.dark` class from the stored theme; "system" follows prefers-color-scheme live. */
export function ThemeController() {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return null;
}
