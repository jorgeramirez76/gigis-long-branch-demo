import {
  ADDRESS_ONE_LINE,
  DIRECTIONS_URL,
  LOCATION,
  MAP_EMBED_URL,
} from "../data/location";
import { HOURS } from "../data/hours";
import { ArrowIcon, ClockIcon, PhoneIcon, PinIcon } from "./Icons";

export function Location() {
  return (
    <section
      id="location"
      className="scroll-mt-20 bg-[var(--color-chrome)] py-20 text-[var(--color-copy)] md:py-28"
    >
      <div className="container-x">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          {/* Info column */}
          <div>
            <span className="eyebrow text-[var(--color-action-text)]" data-reveal>
              Find us
            </span>
            <h2 className="mt-3 text-4xl text-[var(--color-copy)] md:text-6xl" data-reveal style={{ ["--delay" as string]: "80ms" }}>
              140 Brighton Ave.
            </h2>
            <p className="mt-4 max-w-md text-lg text-[var(--color-copy)]/85" data-reveal style={{ ["--delay" as string]: "140ms" }}>
              Right on Brighton Ave in Long Branch — easy parking, easy pickup,
              easy to order by phone.
            </p>

            <dl className="mt-10 space-y-6" data-reveal style={{ ["--delay" as string]: "200ms" }}>
              <InfoRow icon={<PinIcon className="h-5 w-5" />} label="Address">
                {ADDRESS_ONE_LINE}
              </InfoRow>

              <InfoRow icon={<PhoneIcon className="h-5 w-5" />} label="Phone">
                <a
                  href={`tel:${LOCATION.phoneTel}`}
                  className="border-b border-dashed border-[var(--color-gold-bright)]/40 transition hover:text-[var(--color-action-text)]"
                >
                  {LOCATION.phone}
                </a>
              </InfoRow>

              <InfoRow icon={<ClockIcon className="h-5 w-5" />} label="Hours">
                  <div className="grid w-full max-w-sm grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    {HOURS.map((h) => (
                      <div key={h.day} className="flex justify-between gap-3">
                        <span className="shrink-0 text-[var(--color-action-text)]">{h.day}</span>
                        <span className="text-[var(--color-copy)]">{h.label}</span>
                      </div>
                    ))}
                  </div>
              </InfoRow>
            </dl>

            <div className="mt-10 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap" data-reveal style={{ ["--delay" as string]: "280ms" }}>
              <a href={`tel:${LOCATION.phoneTel}`} className="btn-primary w-full sm:w-auto">
                <PhoneIcon className="h-4 w-4" />
                Call Long Branch
              </a>
              <a href="#menu" className="btn-gold w-full sm:w-auto">
                Order Online
                <ArrowIcon className="h-4 w-4" />
              </a>
              <a href={DIRECTIONS_URL} target="_blank" rel="noreferrer" className="btn-outline w-full sm:w-auto">
                <PinIcon className="h-4 w-4" />
                Directions
              </a>
            </div>
          </div>

          {/* Map column */}
          <div className="relative isolate overflow-hidden rounded-3xl p-2" data-reveal="right" style={{ ["--delay" as string]: "200ms" }}>
            <div className="absolute inset-0 -z-10 rounded-3xl bg-[var(--color-brand-red)]/30 blur-2xl" aria-hidden="true" />
            <div className="aspect-[4/3] w-full overflow-hidden rounded-[1.25rem] border border-white/10 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]">
              <iframe
                title={`Map to ${LOCATION.shortName}`}
                src={MAP_EMBED_URL}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="h-full w-full border-0"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-red)]/20 text-[var(--color-action-text)]">
        {icon}
      </div>
      <div className="w-full">
        <dt className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-action-text)]">
          {label}
        </dt>
        <dd className="mt-1 text-[17px] text-[var(--color-copy)]">{children}</dd>
      </div>
    </div>
  );
}
