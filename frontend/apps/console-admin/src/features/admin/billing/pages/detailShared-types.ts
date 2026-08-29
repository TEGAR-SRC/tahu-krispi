/** One entry of a detail-page breadcrumb trail; the last entry is the page. */
export interface Crumb {
  label: string
  /** When set the crumb renders as a link (list pages higher up the trail). */
  to?: string
}
