import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-bg hover:opacity-90 active:opacity-80',
  secondary: 'bg-surface-muted text-text hover:opacity-90 active:opacity-80',
  ghost: 'bg-transparent text-text-muted hover:text-text',
  danger: 'bg-danger-soft text-danger hover:opacity-90',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      // ارتفاع 48px حد أدنى: هدف لمس مريح على التلفون.
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-bold transition disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  )
}
