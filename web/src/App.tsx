import { BookOpen } from 'lucide-react'

export default function App() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
      <BookOpen className="w-16 h-16 mb-4" />
      <h1 className="text-3xl font-bold">Standup Journal</h1>
    </div>
  )
}