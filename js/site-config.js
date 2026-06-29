const SITE = {
  name: 'Storage Hub',
  tagline: 'A unified file manager for Google Drive, local storage, and GitHub repositories.',
  developer: 'Mykhailo Mikus',
  developerUrl: 'https://github.com/fi3ik-mme',
  githubRepo: 'https://github.com/fi3ik-mme/storage-hub',
  homepage: 'https://fi3ik-mme.github.io/storage-hub/',
  basePath: '/storage-hub',
  // Search Console → URL prefix → HTML tag → paste content value here.
  // Must also appear as a static <meta> inside <head> of index.html (Google does not run JS).
  googleSiteVerification: 'eNqApo7Us9h2GKVx8_t4RmmMv1CDldejNsnmMH7RjQ8',
};

(function applySiteHead() {
  if (typeof document === 'undefined') return;

  const description = `${SITE.name} by ${SITE.developer} — ${SITE.tagline}`;

  if (!document.querySelector('meta[name="description"]')) {
    const meta = document.createElement('meta');
    meta.name = 'description';
    meta.content = description;
    document.head.appendChild(meta);
  }

  if (SITE.googleSiteVerification && !document.querySelector('meta[name="google-site-verification"]')) {
    const verify = document.createElement('meta');
    verify.name = 'google-site-verification';
    verify.content = SITE.googleSiteVerification;
    document.head.appendChild(verify);
  }
})();
