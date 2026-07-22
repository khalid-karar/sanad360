import { type ReactNode, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Design-system modal (UX P2: Radix Dialog migration). Replaces the
 * hand-rolled `fixed inset-0` overlays, which had no focus trap, no
 * Escape handling, and no scroll lock. Radix provides all three plus
 * aria-modal semantics. Mobile: bottom-sheet presentation; desktop: centered.
 *
 * Focus-restore-on-close: Radix's Dialog only auto-restores focus to a real
 * Dialog.Trigger it owns — this component is opened by an arbitrary external
 * button in each caller, not a Dialog.Trigger, so without this it left focus
 * on <body> (confirmed via Playwright on FAQModal). Captures whatever was
 * focused right before opening and restores it explicitly via
 * onCloseAutoFocus, so every one of this component's ~13 consumers gets
 * correct focus-restore without each needing to wire it up individually.
 */
export function Modal({
  open,
  onClose,
  title,
  isRTL,
  children,
  maxWidth = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  isRTL: boolean;
  children: ReactNode;
  maxWidth?: string;
}) {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) openerRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1200] bg-gray-900/50" />
        <Dialog.Content
          dir={isRTL ? 'rtl' : 'ltr'}
          onCloseAutoFocus={(e) => {
            if (openerRef.current) {
              e.preventDefault();
              openerRef.current.focus();
            }
          }}
          className={`fixed z-[1200] inset-x-0 bottom-0 sm:inset-auto sm:start-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 rtl:sm:translate-x-1/2
            w-full sm:w-auto sm:min-w-[24rem] ${maxWidth} max-h-[90vh] overflow-y-auto
            rounded-t-2xl sm:rounded-2xl border border-border bg-card text-card-foreground shadow-medium pb-safe`}
        >
          <div className="flex items-center justify-between p-6 pb-2">
            <Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={isRTL ? 'إغلاق' : 'Close'}>
                <XIcon className="w-5 h-5" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="p-6 pt-2">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
