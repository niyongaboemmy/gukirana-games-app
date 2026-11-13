import { redirect } from "next/navigation";

/** Everyone starts at the 3D arrival gate (ID check → playground). /classic stays as the 2D fallback. */
export default function Root() {
  redirect("/gate");
}
