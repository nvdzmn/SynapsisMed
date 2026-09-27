/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        page: "var(--bg-page)",
        surface: "var(--bg-surface)",
        ink: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
        line: "var(--border-default)",
        "line-strong": "var(--border-strong)",
        violet: "var(--action-primary)",
        "violet-press": "var(--action-primary-press)",
        accent: "var(--accent-text)",
        "accent-surface": "var(--accent-surface)",
        "cleared-bg": "var(--status-cleared-bg)",
        "cleared-fg": "var(--status-cleared-fg)",
        "cleared-border": "var(--status-cleared-border)",
        "caution-bg": "var(--status-action-bg)",
        "caution-fg": "var(--status-action-fg)",
        "caution-border": "var(--status-action-border)",
        "blocked-bg": "var(--status-blocked-bg)",
        "blocked-fg": "var(--status-blocked-fg)",
        "blocked-border": "var(--status-blocked-border)",
        "neutral-100": "var(--neutral-100)",
        "neutral-400": "var(--neutral-400)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        display: ["var(--font-jakarta)", "Plus Jakarta Sans", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
