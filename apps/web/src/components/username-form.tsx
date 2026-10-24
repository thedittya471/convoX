"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usernameSchema } from "@convox/contracts";
import { authClient } from "@/lib/auth-client";

export function UsernameForm({ username }: { username: string | null | undefined }) {
  const [value, setValue] = useState(username ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setMessage("");
    const parsed = usernameSchema.safeParse(value);
    if (!parsed.success) {
      setError("Use 3–30 letters, numbers, underscores or dots for your username.");
      return;
    }
    setSaving(true);
    try {
      const result = await authClient.updateUser({ username: parsed.data });
      if (result.error) {
        if (result.error.code === "USERNAME_IS_ALREADY_TAKEN") setError("That username is already taken. Choose another.");
        else if (result.error.status === 401 || result.error.status === 403) setError("Sign in again before changing your username.");
        else if (result.error.status === 429) setError("Too many attempts. Wait a minute and try again.");
        else setError("Could not save your username. Try again; if someone just claimed it, choose another.");
        return;
      }
      setValue(parsed.data);
      setMessage(`Your username is saved as @${parsed.data}.`);
    } catch {
      setError("Could not reach the server. Your username has not been confirmed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-notice" aria-labelledby="username-heading">
      <h2 id="username-heading">{username ? "Change your username" : "Choose a username"}</h2>
      {username && <p className="wrap-break-word">Current username: @{username}</p>}
      <p id="username-policy">People signed in with a verified email can find your display name using your exact username. Usernames are public and editable; after a change, someone else may claim your previous username. You still sign in with your email.</p>
      <form onSubmit={save} aria-busy={saving}>
        <fieldset disabled={saving}>
          <div className="form-field">
            <label htmlFor="account-username">Username</label>
            <input id="account-username" name="username" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" aria-describedby="username-format username-policy" required />
            <p id="username-format" className="field-hint">Use 3–30 letters, numbers, underscores or dots. Saved in lowercase.</p>
          </div>
          {error && <p ref={errorRef} role="alert" tabIndex={-1} className="form-error">{error}</p>}
          {message && <p role="status">{message}</p>}
          <button className="primary-button" type="submit">{saving ? "Saving…" : "Save username"}</button>
        </fieldset>
      </form>
    </section>
  );
}
