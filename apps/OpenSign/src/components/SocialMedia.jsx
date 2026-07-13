import { lhiBranding } from "../config/branding";

const SocialMedia = () => {
  const supportHref = `mailto:${lhiBranding.supportEmail}?subject=Life%20Helpers%20Signature%20Portal%20Support`;

  return (
    <a
      href={supportHref}
      title="Contact Life Helpers Support"
      aria-label="Contact Life Helpers Support"
      className="lhi-focus-ring inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--lhi-primary)] text-white shadow-md transition hover:bg-[#cf252b]"
    >
      <i aria-hidden="true" className="fa-light fa-envelope"></i>
    </a>
  );
};

export default SocialMedia;
