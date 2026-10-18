export interface Clock {
  /** Returns a UTC instant; a civil date requires an explicit IANA time zone. */
  now(): Date;
}
