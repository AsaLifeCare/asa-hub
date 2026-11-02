/** A missing value drawn the one way: "Not on file", never a blank or a made-up zero. */
import { createElement, type ReactNode } from 'react'
import { None } from './StaffParts'

export const none: ReactNode = createElement(None)

/** A value, or "Not on file". */
export const orNone = (v: ReactNode): ReactNode => (v === '' || v === null || v === undefined ? none : v)
