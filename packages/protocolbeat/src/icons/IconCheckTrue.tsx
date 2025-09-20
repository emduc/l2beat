import { Icon } from './Icon'

export function IconCheckTrue(props: { className?: string }) {
  return (
    <Icon {...props}>
      <path
        d="M3 8L7 12L13 4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  )
}