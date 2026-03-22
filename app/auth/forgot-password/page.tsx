"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { ROUTES } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ForgotPasswordPage() {
  const RESEND_COOLDOWN_SECONDS = 60;

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [cooldown]);


  const handleDialogChange = (isOpen: boolean) => {
    setOpen(isOpen);
  };

  const handleCancelReset = () => {
    router.push(ROUTES.AUTH_LOGIN);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Erro ao enviar e-mail de recuperação.' }));
      setError(data.error ?? 'Erro ao enviar e-mail de recuperação.');
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
      if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
        setCooldown(retryAfterSeconds);
      }
    } else {
      setSuccess(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Dialog open={open} onOpenChange={handleDialogChange}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Recuperar senha</DialogTitle>
          </DialogHeader>
          <DialogClose asChild>
            <button
              type="button"
              onClick={handleCancelReset}
              className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
              aria-label="Fechar"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </DialogClose>
          <form onSubmit={handleSubmit} className="space-y-4">
            {success && (
              <Alert>
                <AlertDescription>
                  Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">E-mail</label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                autoFocus
              />
            </div>
            <Button type="submit" disabled={loading || cooldown > 0} className="w-full">
              {loading ? "Enviando..." : cooldown > 0 ? `Aguarde ${cooldown}s para reenviar` : "Enviar link de recuperação"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
