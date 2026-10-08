export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

class Dialogs {
  confirm = $state<ConfirmRequest | null>(null);

  /** Ask a yes/no question; resolves true if the user confirms. */
  ask(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    this.confirm?.resolve(false);
    return new Promise((resolve) => {
      this.confirm = {
        ...req,
        resolve: (ok) => {
          this.confirm = null;
          resolve(ok);
        },
      };
    });
  }
}

export const dialogs = new Dialogs();
