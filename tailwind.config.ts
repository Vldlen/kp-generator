import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        inno: {
          orange: '#FF6B00',
          dark: '#1A1A2E',
          blue: '#4A90D9',
        },
        bonda: {
          purple: '#7B2FBE',
          dark: '#2D1B4E',
        },
      },
    },
  },
  plugins: [],
}
export default config
