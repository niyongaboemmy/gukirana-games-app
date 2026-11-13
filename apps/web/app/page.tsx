import { redirect } from "next/navigation";

/** Everyone starts at the 3D arrival gate (ID check → playground). */
export default function Root() {
  redirect("/gate");
}
