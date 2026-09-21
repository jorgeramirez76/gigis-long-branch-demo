/**
 * The "make this your Gigi's" panel on the order-confirmation screen.
 *
 * ONE EMAIL, ONE LINK (2026-09-21). When the customer ticked the VIP box at checkout, a
 * confirmation email is ALREADY in their inbox by the time they read this. Creating an account no
 * longer sends a second one: api/lib/accountHandler.ts parks the signup on that pending
 * verification and api/vip-verify.ts offers the password step on the landing page. So this panel
 * says exactly that — otherwise the customer sees "Create account", expects mail, and reads the
 * verification email they already have as the wrong one. (The owner's words for the old behaviour:
 * "back-and-forth with the emails".)
 */
export function RewardsJoin({name,phone,email,address,city="",vipJoin}: {name:string;phone:string;email:string;address:string;city?:string;vipJoin?:{status:"verify_sent"|"already_member";email?:string}}) {
 const sent = vipJoin?.status === "verify_sent";
 return <div className="rounded-2xl border border-[var(--color-line)] p-5">
  <h3 className="text-xl">{sent ? "Check your email — one link finishes it" : "Make this your Gigi’s"}</h3>
  {sent
   ? <p className="my-3 text-sm">We just sent <strong>one email</strong> to {vipJoin?.email || email}. Tap the link in it once and it does everything: confirms your email, unlocks your free plain cheese pie code, and lets you choose a password so this order, your code and your favorites are saved. No second email to wait for.</p>
   : <p className="my-3 text-sm">Save this order to your account, find your welcome pie code, and reorder your favorites. One email, one link — you’ll choose your password from it.</p>}
  <a className="btn-primary" href="/account/?join=1" onClick={()=>{try{sessionStorage.setItem("gigis_rewards_profile",JSON.stringify({name,phone,email,address,city,state:"NJ"}));}catch{/* The form still works without storage. */}}}>{sent ? "Set up my account" : "Create account / Sign in"}</a>
 </div>;
}
