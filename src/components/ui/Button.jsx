import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-xl border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-[var(--ds-accent)] px-4 py-2 text-white hover:opacity-90',
        secondary: 'border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-2 text-[var(--ds-text)] hover:bg-[var(--ds-surface-soft)]',
        ghost: 'border-transparent bg-transparent px-3 py-2 text-[var(--ds-muted)] hover:bg-[var(--ds-accent-soft)] hover:text-[var(--ds-text)]',
        danger: 'border-transparent bg-[var(--ds-danger)] px-4 py-2 text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)

export function Button({ className, variant, size, type = 'button', ...props }) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
