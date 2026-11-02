// Settings → Business Travel.
// Short on purpose.
import { motion } from 'framer-motion'
import Card, { CardHeader } from '@/components/shared/Card'
import { EASE_OUT_EXPO } from '@/engine/motion'
import TestLane from './TestLane'

export default function TravelSection() {
  return (
    <motion.section id="travel" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
      className="scroll-mt-[84px]">
      <Card padded={false} className="p-6">
        <CardHeader title="Company Travel" sub="Who decides, what gets asked for, and what the app sends." />

        <div className="space-y-4">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Who can approve</p>
            <p className="mt-1 text-[11.5px] leading-5 text-text-3">
              Admins and managers, and it is not configurable from here. Approving a trip commits money, so the list of
              people who can do it belongs with the other role decisions in
              <strong className="text-text-2"> Access control</strong> — not in a dropdown inside the app that spends it.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Two things the app insists on</p>
            <ul className="mt-1 space-y-1.5 text-[11.5px] leading-5 text-text-3">
              <li>
                <strong className="text-text-2">A reason, always.</strong> It is the only required field besides the
                destination. A trip with no stated reason cannot be approved, declined or learned from.
              </li>
              <li>
                <strong className="text-text-2">A reason when declining, too.</strong> “Declined” on its own is the
                message people remember and nobody can act on, so it is asked for at the moment of deciding.
              </li>
            </ul>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">There is no price watch</p>
            <p className="mt-1 text-[11.5px] leading-5 text-text-3">
              The module this replaces ran a daily job that asked a language model for flight deals and
              <strong className="text-text-2"> texted the results</strong> — with an airline, a price to the cent and a
              link, none of it looked up, and the alert threshold written into the request so nearly anything fired.
              Nothing like it exists here. Budget and actual cost are typed by whoever saw the invoice; the variance is
              arithmetic. Real fares would mean a carrier API, and would be a different field.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-text-2">Sending</p>
            <TestLane app="Company Travel" sends="the nudge for a finished trip with no note on what came of it" />
          </div>
        </div>
      </Card>
    </motion.section>
  )
}
