import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: false, // Disable Svelte 5 runes mode to use legacy reactivity
  },
};
