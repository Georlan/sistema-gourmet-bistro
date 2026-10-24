/** Original service illustration: cloche, tray and the hand that carries it.
 * Inline paths only; no images, filters, animation or network dependencies. */
export function WaiterServiceArtwork({ className = '' }: { className?: string }) {
  return <svg className={`kw-service-art ${className}`} viewBox="0 0 240 110" fill="none" aria-hidden="true" focusable="false">
    <path className="kw-service-art__field" d="M82 0h158v110H31c-7-16 12-29 32-34C106 66 44 24 82 0Z" />
    <path className="kw-service-art__leaf" d="M194 5c-22 1-35 15-37 36 22-1 35-15 37-36Z" />
    <path className="kw-service-art__leaf" d="M216 26c-21-5-39 3-48 22 21 5 39-3 48-22Z" />
    <path className="kw-service-art__dome" d="M83 62a39 39 0 0 1 78 0H83Z" />
    <path className="kw-service-art__line" d="M76 68h93M122 23v-5M104 35c-8 3-13 10-15 17" />
    <circle className="kw-service-art__knob" cx="122" cy="16" r="5" />
    <path className="kw-service-art__hand" d="m31 108 43-26c8-5 13-5 20-4l24 3 13-4c7-2 10 5 4 8l-17 8-23-1-26 18H31Z" />
    <path className="kw-service-art__line" d="m46 99 16 11M94 78l18-6c6-2 9 3 5 7" />
    <path className="kw-service-art__spark" d="m201 70 7-10 7 10-7 10-7-10ZM181 92l4-6 4 6-4 6-4-6Z" />
  </svg>;
}
