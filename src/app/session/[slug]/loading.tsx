export default function SessionLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="h-8 w-56 animate-pulse rounded-xl bg-surface-800" />
      <div className="flex flex-1 gap-4">
        <div className="flex-1 rounded-2xl bg-surface-900 animate-pulse" />
        <div className="w-80 rounded-2xl bg-surface-900 animate-pulse" />
      </div>
    </div>
  )
}

