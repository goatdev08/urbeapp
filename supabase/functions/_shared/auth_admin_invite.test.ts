// supabase/functions/_shared/auth_admin_invite.test.ts
// Tests del adaptador REAL make_auth_admin().inviteUserByEmail — tareas #178 y
// #177 (y cierra, para ESTE seam, el hueco de cobertura que #174 nombra).
//
// ════════════════════════════════════════════════════════════════════════════
// #178 — EL CORREO DE INVITACIÓN NO LLEVABA A NINGUNA PARTE.
// OWNER_INVITE_REDIRECT_TO valía "urbea://" (la raíz) y NADIE monta
// useSessionFromDeepLink en la raíz: el owner abría el correo, entraba a la
// app, y los tokens del fragmento SE PERDÍAN. Quedaba sin sesión y sin forma
// de fijar contraseña. El correo que construyó #168 no llevaba a ningún lado.
//
// 🔴 EL DESTINO YA EXISTE Y ESTÁ PROBADO, no hay que construirlo:
// mobile/app/reset-password.tsx monta useSessionFromDeepLink (:62) y fija la
// contraseña con supabase.auth.updateUser({password}). Es exactamente el flujo
// que necesita el owner invitado, y es a donde ya apunta la recuperación de
// contraseña (context.tsx:154, Linking.createURL('reset-password')), con su
// propio test de deep link. El fix es apuntar ahí, no inventar una pantalla.
// (La ejecución de 168.5 concluyó que "no existe hoy una pantalla destino" y
// eso era falso.)
//
// #177 — EL LINK DE RESPALDO TAMPOCO. inviteUserByEmail no devuelve
// action_link, así que se recupera con un segundo generateLink('magiclink')
// que se llamaba SIN redirectTo — o sea que apuntaba al site_url. El link que
// el admin copia al portapapeles no abría la app. Es el ÚNICO respaldo cuando
// el correo no llega, así que un respaldo que no funciona no es un respaldo.
//
// 🔴 LOS DOS LINKS TIENEN QUE APUNTAR AL MISMO SITIO. Que el correo lleve a un
// lado y el respaldo a otro es peor que cualquiera de los dos bugs por
// separado: el admin no podría reproducir lo que le pasa al invitado.
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals } from "@std/assert";
import { make_auth_admin } from "./clients.ts";
import type { InviteByEmailParams, InviteByEmailResponse } from "./auth_user.ts";

/**
 * `inviteUserByEmail` es OPCIONAL en AuthAdminClient (los consumidores viejos
 * no lo implementan), así que se resuelve una vez y se falla ruidosamente si
 * no está — en vez de sembrar `!` en cada llamada, que taparía justo el caso
 * de que el adaptador dejara de exponerlo.
 */
function invite_of(client: unknown): (p: InviteByEmailParams) => Promise<InviteByEmailResponse> {
  const admin = make_auth_admin(client as never);
  if (typeof admin.inviteUserByEmail !== "function") {
    throw new Error("make_auth_admin dejó de exponer inviteUserByEmail");
  }
  return admin.inviteUserByEmail.bind(admin);
}

interface InviteCall {
  email: string;
  options: { redirectTo?: string; data?: Record<string, unknown> };
}
interface GenerateLinkCall {
  type: string;
  email: string;
  options?: { redirectTo?: string };
}

function make_fake_client(opts: { invite_error?: { message: string } } = {}) {
  const invite_calls: InviteCall[] = [];
  const generate_link_calls: GenerateLinkCall[] = [];

  const client = {
    auth: {
      admin: {
        inviteUserByEmail(email: string, options: InviteCall["options"]) {
          invite_calls.push({ email, options });
          return Promise.resolve(
            opts.invite_error
              ? { data: null, error: opts.invite_error }
              : { data: { user: { id: "user-uuid-1" } }, error: null },
          );
        },
        generateLink(params: GenerateLinkCall) {
          generate_link_calls.push(params);
          return Promise.resolve({
            data: { properties: { action_link: "https://link-de-respaldo.test/x" } },
            error: null,
          });
        },
      },
    },
  };

  return { client, invite_calls, generate_link_calls };
}

const EMAIL = "owner@ejemplo.mx";

// ── #178: a dónde apunta el correo ──────────────────────────────────────────

Deno.test("178_el_correo_de_invitacion_apunta_a_reset_password_no_a_la_raiz", async () => {
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  await invite({ email: EMAIL });

  assertEquals(
    fake.invite_calls[0].options.redirectTo,
    "urbea://reset-password",
    "la raíz (urbea://) no monta useSessionFromDeepLink: los tokens del fragmento se pierden ahí",
  );
});

Deno.test("178_un_redirectTo_explicito_del_caller_sigue_ganando", async () => {
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  await invite({ email: EMAIL, redirectTo: "urbea://otro-destino" });

  assertEquals(fake.invite_calls[0].options.redirectTo, "urbea://otro-destino");
});

// ── #177: a dónde apunta el link de respaldo ────────────────────────────────

Deno.test("177_el_link_de_respaldo_tambien_lleva_redirectTo", async () => {
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  await invite({ email: EMAIL });

  assertEquals(fake.generate_link_calls.length, 1, "debe generarse el link de respaldo");
  assertEquals(
    fake.generate_link_calls[0].options?.redirectTo,
    "urbea://reset-password",
    "sin redirectTo el link apunta al site_url y no abre la app",
  );
});

Deno.test("177_los_DOS_links_apuntan_al_MISMO_destino", async () => {
  // Caso pareado y el más importante de los dos: si el correo lleva a un lado
  // y el respaldo a otro, el admin no puede reproducir lo que ve el invitado.
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  await invite({ email: EMAIL });

  assertEquals(
    fake.generate_link_calls[0].options?.redirectTo,
    fake.invite_calls[0].options.redirectTo,
  );
});

Deno.test("177_el_redirectTo_del_caller_tambien_se_propaga_al_respaldo", async () => {
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  await invite({ email: EMAIL, redirectTo: "urbea://otro-destino" });

  assertEquals(fake.generate_link_calls[0].options?.redirectTo, "urbea://otro-destino");
});

// ── No-regresión del contrato que ya existía ────────────────────────────────

Deno.test("el_user_metadata_del_caller_viaja_intacto", async () => {
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  await invite({ email: EMAIL, data: { first_name: "Ana", last_name: "Ruiz" } });

  assertEquals(fake.invite_calls[0].options.data, { first_name: "Ana", last_name: "Ruiz" });
});

Deno.test("si_inviteUserByEmail_falla_no_se_intenta_el_respaldo_y_se_devuelve_el_error", async () => {
  const fake = make_fake_client({ invite_error: { message: "already registered" } });
  const invite = invite_of(fake.client);
  const result = await invite({ email: EMAIL });

  assertEquals(result.data, null);
  assertEquals(result.error?.message, "already registered");
  assertEquals(fake.generate_link_calls.length, 0, "sin usuario creado no hay respaldo que generar");
});

Deno.test("el_happy_path_devuelve_el_action_link_del_respaldo_y_email_sent", async () => {
  const fake = make_fake_client();
  const invite = invite_of(fake.client);
  const result = await invite({ email: EMAIL });

  assertEquals(result.data?.action_link, "https://link-de-respaldo.test/x");
  assertEquals(result.data?.email_sent, true);
  assertEquals(result.data?.user.id, "user-uuid-1");
});
