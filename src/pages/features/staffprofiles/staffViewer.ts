// Who is looking at Staff, as the page decides it once: whether this session writes (the master in its own session)…
// Sections read it instead of deciding again; a door the viewer cannot use is not drawn.
import { createContext, useContext } from 'react'
import { WHOLE_VIEWER, type StaffViewer } from './staffModel'

export const StaffViewerContext = createContext<StaffViewer>(WHOLE_VIEWER)

export const useStaffViewer = (): StaffViewer => useContext(StaffViewerContext)
