/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: "#22C55E",
        sidebar: {
          light: "#f8f8f8",
          dark: "#1e1e2e",
        },
      },
    },
  },
  plugins: [],
};
