/** @type {import('tailwindcss').Config} */
function token(name) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("--c-bg"),
        panel: token("--c-panel"),
        panel2: token("--c-panel2"),
        panel3: token("--c-panel3"),
        node: token("--c-node"),
        line: token("--c-line"),
        line2: token("--c-line2"),
        ink: token("--c-ink"),
        dim: token("--c-dim"),
        faint: token("--c-faint"),
        acc: token("--c-acc"),
        acc2: token("--c-acc2"),
        low: token("--c-low"),
        med: token("--c-med"),
        high: token("--c-high"),
        crit: token("--c-crit"),
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,63,164,0.5), 0 8px 30px rgba(255,63,164,0.28)",
        "glow-soft": "0 6px 24px rgba(166,75,255,0.25)",
      },
      keyframes: {
        fade: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        pop: {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        slideright: {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        slideup: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fade: "fade 0.16s ease-out",
        pop: "pop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)",
        slideright: "slideright 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)",
        slideup: "slideup 0.18s ease-out",
      },
    },
  },
  plugins: [],
};
