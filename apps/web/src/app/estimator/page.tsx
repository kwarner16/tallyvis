import { redirect } from "next/navigation";
import { ESTIMATOR_URL } from "@/lib/urls";

export default function EstimatorRedirectPage() {
  redirect(ESTIMATOR_URL);
}
