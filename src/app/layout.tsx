import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'КП Генератор — INNO Clouds',
  description: 'Автоматическое создание коммерческих предложений',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
