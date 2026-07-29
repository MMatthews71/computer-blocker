/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0c10',
          900: '#0e0f13',
          850: '#121319',
          800: '#16181f',
          700: '#1c1f27',
          600: '#23262f',
        },
        accent: {
          DEFAULT: '#7c9cff',
          strong: '#5a7dff',
        },
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
