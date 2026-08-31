import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 border rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-fg hover:bg-fg/5 hover:border-fg/35 active:translate-y-[1px]",
        primary: "border-accent bg-accent text-accent-on hover:bg-accent-hover hover:border-accent-hover active:translate-y-[1px]",
        dangerLink: "border-transparent bg-transparent text-danger hover:underline font-normal text-xs p-0 min-h-0",
        textLink: "border-transparent bg-transparent text-accent hover:underline font-normal text-xs p-0 min-h-0",
        icon: "border-transparent bg-transparent text-muted hover:text-fg hover:bg-bg rounded-md",
      },
      size: {
        default: "min-h-[40px] px-[13px] py-[9px]",
        sm: "min-h-[36px] px-3",
        icon: "h-[30px] w-[30px] text-[18px]",
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
