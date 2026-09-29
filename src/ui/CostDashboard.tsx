export function CostDashboard({ messages }: { messages: { meta?: string }[] }) {
  const freeCount = messages.filter((m) => m.meta?.includes('مجاني')).length
  return (
    <div className="flex justify-center">
      <span className="rounded-full border border-[#19c37d]/20 bg-[#19c37d]/10 px-3 py-1 text-xs text-[#19c37d]">
        وفرت {freeCount} طلبات مجانية
      </span>
    </div>
  )
}
