import * as React from "react"
import { cn } from "../../lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-fg",
          "transition-all duration-150",
          "placeholder:text-muted-light",
          "hover:border-border-hover",
          "focus:border-accent focus:ring-2 focus:ring-accent/20",
          "focus-visible:outline-none",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
