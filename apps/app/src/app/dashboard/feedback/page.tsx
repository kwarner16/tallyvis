import { FeedbackForm } from "@/components/dashboard/FeedbackForm";

export default function FeedbackPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Feedback</h1>
        <p className="text-ink-soft">
          Something broke? Have a suggestion or a feature you&rsquo;d like to see? Tell us directly — Kyle
          reads every submission.
        </p>
      </div>
      <FeedbackForm />
    </div>
  );
}
