import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Relative asset paths let the same build run at a GitHub Pages repository subpath.
export default defineConfig({ plugins: [svelte()], base: './' })
