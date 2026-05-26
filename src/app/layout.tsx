import './globals.css'
import type { Metadata } from 'next'
import { Unbounded, Golos_Text, JetBrains_Mono } from 'next/font/google'

// «Печатный цех» — типографика редизайна 2026-05.
// Дисплейный — Unbounded (геометрический, кириллица).
// Текстовый — Golos Text (русскоязычная гарнитура).
// Моноширинный — JetBrains Mono (кириллица + знак ₽, для цен и подписей).
const display = Unbounded({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '700'],
  variable: '--font-display',
  display: 'swap',
})
const text = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-text',
  display: 'swap',
})
const mono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'КП Генератор — inno clouds',
  description: 'Автоматическое создание коммерческих предложений',
}

// No-flash: применяем сохранённую тему до первой отрисовки.
const themeScript = `(function(){try{var t=localStorage.getItem('kp-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${display.variable} ${text.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
