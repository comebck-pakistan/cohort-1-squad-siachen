import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FieldError — Wave 16.
//
// Renders the red helper text below a form input. Kept dead simple so
// it composes cleanly with the existing <Field> wrapper in payment.tsx
// and the inline "relative" + icon-on-left pattern in onboarding.tsx.
//
// Two render modes:
//   - With a non-empty `error` prop →  red text + danger icon
//   - With an empty `error` prop   →  nothing (zero-height container,
//                                      so the surrounding layout doesn't
//                                      jump when an error appears/clears)
//
// We also expose a `className` so callers can drop one of these in
// tight grids without wrapping in extra divs.
// ---------------------------------------------------------------------------

export function FieldError({
  error,
  className,
}: {
  error: string | null | undefined;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className={cn(
        "mt-1 text-xs font-medium text-[oklch(0.4_0.18_27)]",
        className,
      )}
    >
      {error}
    </p>
  );
}
