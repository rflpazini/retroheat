import { Window } from '@/components/Window'

interface MessageProps {
  title: string
  detail: string
  action?: React.ReactNode
}

export function Message({ title, detail, action }: MessageProps) {
  return (
    <Window title={title}>
      <p className="pixel mb-2 text-[0.6rem]">{title}</p>
      <p className="max-w-md text-xs">{detail}</p>
      {action && <div className="mt-3">{action}</div>}
    </Window>
  )
}

export function LoadError({ what }: { what: string }) {
  return (
    <Message
      title={`Could not load ${what}`}
      detail="The data files are published by a scheduled job. If this is a fresh checkout, run the collector once to generate them."
    />
  )
}
