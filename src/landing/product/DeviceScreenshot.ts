/** A replaceable screen, independent of the rendered device shell. */
export interface DeviceScreenshot {
  src: string;
  alt: string;
  /** Preserve the whole capture unless an editorial crop is explicitly chosen. */
  fit?: 'contain' | 'cover';
  position?: string;
}
