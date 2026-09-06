import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { LockKeyhole, LoaderCircle } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import { login } from "../../services/authApi.ts";
import { ApiRequestError } from "../../services/apiClient.ts";

interface LoginPageProps {
  onAuthenticated: () => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordInvalid, setIsPasswordInvalid] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (error && !isSubmitting) {
      passwordRef.current?.focus();
      if (isPasswordInvalid) passwordRef.current?.select();
    }
  }, [error, isSubmitting, isPasswordInvalid]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting || !password) return;
    setError("");
    setIsPasswordInvalid(false);
    setIsSubmitting(true);

    try {
      await login(password);
      onAuthenticated();
    } catch (caught) {
      const incorrectPassword = caught instanceof ApiRequestError && caught.status === 401;
      setIsPasswordInvalid(incorrectPassword);
      setError(t(incorrectPassword ? "auth.incorrectPassword" : "auth.connectionError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-card__icon" aria-hidden="true">
          <LockKeyhole size={25} />
        </span>
        <p className="eyebrow">Cortex</p>
        <h1 id="login-title">{t("auth.title")}</h1>
        <p className="login-card__description">{t("auth.description")}</p>
        <form aria-busy={isSubmitting} onSubmit={(event) => void handleSubmit(event)}>
          <label className="editor-field">
            <span>{t("auth.password")}</span>
            <input
              type="password"
              ref={passwordRef}
              name="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
                setIsPasswordInvalid(false);
              }}
              aria-invalid={isPasswordInvalid || undefined}
              aria-describedby={error ? errorId : undefined}
              autoComplete="current-password"
              autoFocus
              required
              disabled={isSubmitting}
            />
          </label>
          {error && <p id={errorId} className="error" role="alert">{error}</p>}
          <button type="submit" disabled={isSubmitting || !password}>
            {isSubmitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
            {isSubmitting ? t("auth.connecting") : t("auth.login")}
          </button>
        </form>
      </section>
    </main>
  );
}
