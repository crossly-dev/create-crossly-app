export function SetupNotice({ value }: { value: string | undefined }) {
  const looksLikePat = typeof value === 'string' && value.startsWith('crossly_pat_');
  return (
    <section className="notice">
      <h1>Almost there</h1>
      {looksLikePat ? (
        <p>
          <strong>That is a personal access token, not a publishable key.</strong> A PAT is a full-access credential and
          must never be in a web page: revoke it in Settings → API &amp; webhooks and mint a publishable key instead.
        </p>
      ) : null}
      <p>
        Set <code>NEXT_PUBLIC_CROSSLY_PK</code> in <code>.env.local</code> to your publishable key (
        <code>crossly_pk_live_…</code>), from <strong>Settings → Embeds</strong> in Crossly, then restart the dev server.
      </p>
      <p>
        A publishable key is meant to be public: it can read your active listings and start a Crossly-hosted checkout,
        nothing else.
      </p>
    </section>
  );
}
