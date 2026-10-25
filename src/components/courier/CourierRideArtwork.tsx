/** Original KÔMA illustration, paired with the waiter's service artwork.
 * Flat vector shapes keep the rider legible without an image download or animation. */
export function CourierRideArtwork({ className = '' }: { className?: string }) {
  return <svg className={`k-courier-ride ${className}`} viewBox="0 0 240 144" fill="none" aria-hidden="true" focusable="false">
    <path className="k-courier-ride__field" d="M65 8h128c27 0 39 20 30 44l-20 57c-5 15-17 23-35 23H34c-15 0-21-15-10-27l27-29C74 51 35 8 65 8Z" />
    <path className="k-courier-ride__motion" d="M15 70h17M7 82h20" />
    <circle className="k-courier-ride__tire" cx="68" cy="117" r="21" />
    <circle className="k-courier-ride__tire" cx="186" cy="117" r="21" />
    <circle className="k-courier-ride__hub" cx="68" cy="117" r="10" />
    <circle className="k-courier-ride__hub" cx="186" cy="117" r="10" />
    <path className="k-courier-ride__scooter" d="M43 106c4-13 14-20 29-20h34l17 18h22c6 0 10-4 13-10l8-22h18l10 33h-16l-8 15H98c-6-19-23-25-39-16l-16 2Z" />
    <path className="k-courier-ride__paper" d="m166 72-7 18h28l-5-18h-16Z" />
    <path className="k-courier-ride__line" d="m181 114-14-47-10-5h-9M99 120h39M50 88h48" />
    <rect className="k-courier-ride__box" x="34" y="49" width="56" height="35" rx="7" />
    <path className="k-courier-ride__box-line" d="M35 59h54M62 50v9" />
    <path className="k-courier-ride__paper" d="m52 71 10-8 10 8-5 5-5-4-5 4-5-5Z" />
    <path className="k-courier-ride__trousers" d="m103 76 26 6c8 2 11 8 7 15l-6 11h-16l9-14-23-2c-12-1-15-11-9-20l12 4Z" />
    <path className="k-courier-ride__shirt" d="M113 41c7-2 14 0 19 7l12 15 15 1-2 10-22-2-13-12-9 24-23-6 13-29c2-4 6-7 10-8Z" />
    <path className="k-courier-ride__paper" d="m146 63 14 1c7 0 9 9 1 10h-14V63ZM121 27h22v13c0 7-8 10-14 6l-8-6V27Z" />
    <path className="k-courier-ride__helmet" d="M116 33V28a19 19 0 0 1 38 0v5h-38Z" />
    <path className="k-courier-ride__line" d="M117 33h38M127 21c2-3 5-4 9-4M143 36v6" />
    <path className="k-courier-ride__shoe" d="M114 105h16l6 7h-26l4-7Z" />
  </svg>;
}
