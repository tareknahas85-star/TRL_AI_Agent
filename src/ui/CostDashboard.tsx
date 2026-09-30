import { Chip } from './components/ui'

export function CostDashboard({ messages }: { messages: { meta?: string }[] }) {
  const replies = messages.filter((m) => m.meta)
  const free = replies.filter((m) => m.meta?.includes('مجاني')).length
  const cheap = replies.filter((m) => m.meta?.includes('رخيص')).length
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Chip cls="bg-success/15 text-success">وفرت {free} طلبات مجانية</Chip>
      <Chip cls="bg-primary/15 text-primary">{cheap} رخيصة</Chip>
      <Chip>{replies.length} ردود</Chip>
    </div>
  )
}
