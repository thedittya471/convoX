-- REFERENCE SNAPSHOT ONLY: apply reviewed apps/server/drizzle migrations, not this file.
-- PostgreSQL 17 disposable database after migrations 0000 through 0006; no table data.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg12+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation (
    id uuid NOT NULL,
    direct_user_low_id text NOT NULL,
    direct_user_high_id text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    last_message_sequence bigint DEFAULT 0 NOT NULL,
    CONSTRAINT conversation_direct_pair_check CHECK (((direct_user_low_id COLLATE "C") < (direct_user_high_id COLLATE "C")))
);


--
-- Name: history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.history (
    singleton boolean DEFAULT true NOT NULL,
    generation uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT history_singleton CHECK ((singleton = true))
);


--
-- Name: jwks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jwks (
    id text NOT NULL,
    public_key text NOT NULL,
    private_key text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    alg text,
    crv text
);


--
-- Name: message; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id text NOT NULL,
    client_message_id uuid NOT NULL,
    sequence bigint NOT NULL,
    encrypted_payload text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_sequence_positive CHECK ((sequence > 0))
);


--
-- Name: message_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_outbox (
    message_id uuid NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    published_at timestamp(3) with time zone
);


--
-- Name: oauth_access_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_access_token (
    id text NOT NULL,
    token text NOT NULL,
    client_id text NOT NULL,
    session_id text,
    user_id text,
    reference_id text,
    authorization_code_id text,
    resources text[],
    requested_user_info_claims text[],
    refresh_id text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked timestamp with time zone,
    confirmation jsonb,
    scopes text[] NOT NULL
);


--
-- Name: oauth_client; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_client (
    id text NOT NULL,
    client_id text NOT NULL,
    client_secret text,
    client_discovery_id text,
    disabled boolean DEFAULT false,
    skip_consent boolean,
    enable_end_session boolean,
    subject_type text,
    scopes text[],
    client_credentials_scopes text[],
    user_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name text,
    uri text,
    icon text,
    contacts text[],
    tos text,
    policy text,
    software_id text,
    software_version text,
    software_statement text,
    redirect_uris text[] NOT NULL,
    post_logout_redirect_uris text[],
    backchannel_logout_uri text,
    backchannel_logout_session_required boolean,
    token_endpoint_auth_method text,
    application_type text,
    jwks text,
    jwks_uri text,
    grant_types text[],
    response_types text[],
    require_p_k_c_e boolean,
    dpop_bound_access_tokens boolean DEFAULT false,
    reference_id text,
    metadata jsonb
);


--
-- Name: oauth_client_assertion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_client_assertion (
    id text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: oauth_client_resource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_client_resource (
    id text NOT NULL,
    client_id text NOT NULL,
    resource_id text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone
);


--
-- Name: oauth_consent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_consent (
    id text NOT NULL,
    client_id text NOT NULL,
    user_id text,
    reference_id text,
    resources text[],
    requested_user_info_claims text[],
    scopes text[] NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: oauth_refresh_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_refresh_token (
    id text NOT NULL,
    token text NOT NULL,
    client_id text NOT NULL,
    session_id text,
    user_id text NOT NULL,
    reference_id text,
    authorization_code_id text,
    resources text[],
    requested_user_info_claims text[],
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked timestamp with time zone,
    rotated_at timestamp with time zone,
    rotation_replay_response text,
    rotation_replay_expires_at timestamp with time zone,
    auth_time timestamp with time zone,
    confirmation jsonb,
    scopes text[] NOT NULL
);


--
-- Name: oauth_resource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_resource (
    id text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    access_token_ttl integer,
    refresh_token_ttl integer,
    signing_algorithm text,
    signing_key_id text,
    allowed_scopes text[],
    custom_claims jsonb,
    dpop_bound_access_tokens_required boolean DEFAULT false,
    disabled boolean DEFAULT false,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    policy_version integer DEFAULT 1,
    metadata jsonb
);


--
-- Name: rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit (
    id text NOT NULL,
    key text NOT NULL,
    count integer NOT NULL,
    last_request bigint NOT NULL
);


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session (
    id text NOT NULL,
    token text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    username text
);


--
-- Name: verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: conversation conversation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation
    ADD CONSTRAINT conversation_pkey PRIMARY KEY (id);


--
-- Name: history history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.history
    ADD CONSTRAINT history_pkey PRIMARY KEY (singleton);


--
-- Name: jwks jwks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);


--
-- Name: message_outbox message_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_outbox
    ADD CONSTRAINT message_outbox_pkey PRIMARY KEY (message_id);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (id);


--
-- Name: oauth_access_token oauth_access_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_pkey PRIMARY KEY (id);


--
-- Name: oauth_access_token oauth_access_token_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_token_unique UNIQUE (token);


--
-- Name: oauth_client_assertion oauth_client_assertion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client_assertion
    ADD CONSTRAINT oauth_client_assertion_pkey PRIMARY KEY (id);


--
-- Name: oauth_client oauth_client_client_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client
    ADD CONSTRAINT oauth_client_client_id_unique UNIQUE (client_id);


--
-- Name: oauth_client oauth_client_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client
    ADD CONSTRAINT oauth_client_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_resource oauth_client_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client_resource
    ADD CONSTRAINT oauth_client_resource_pkey PRIMARY KEY (id);


--
-- Name: oauth_consent oauth_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_consent
    ADD CONSTRAINT oauth_consent_pkey PRIMARY KEY (id);


--
-- Name: oauth_refresh_token oauth_refresh_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_pkey PRIMARY KEY (id);


--
-- Name: oauth_refresh_token oauth_refresh_token_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_token_unique UNIQUE (token);


--
-- Name: oauth_resource oauth_resource_identifier_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_resource
    ADD CONSTRAINT oauth_resource_identifier_unique UNIQUE (identifier);


--
-- Name: oauth_resource oauth_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_resource
    ADD CONSTRAINT oauth_resource_pkey PRIMARY KEY (id);


--
-- Name: rate_limit rate_limit_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit
    ADD CONSTRAINT rate_limit_key_unique UNIQUE (key);


--
-- Name: rate_limit rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit
    ADD CONSTRAINT rate_limit_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);


--
-- Name: user user_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user user_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_username_unique UNIQUE (username);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: account_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_provider_idx ON public.account USING btree (provider_id, account_id);


--
-- Name: account_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_user_idx ON public.account USING btree (user_id);


--
-- Name: conversation_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_created_idx ON public.conversation USING btree (created_at DESC NULLS LAST, id DESC NULLS LAST);


--
-- Name: conversation_direct_high_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_direct_high_user_idx ON public.conversation USING btree (direct_user_high_id);


--
-- Name: conversation_direct_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_direct_pair_idx ON public.conversation USING btree (direct_user_low_id, direct_user_high_id);


--
-- Name: message_conversation_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_conversation_sequence_idx ON public.message USING btree (conversation_id, sequence);


--
-- Name: message_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_outbox_pending_idx ON public.message_outbox USING btree (created_at, message_id) WHERE (published_at IS NULL);


--
-- Name: message_sender_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_sender_client_idx ON public.message USING btree (sender_id, client_message_id);


--
-- Name: oauth_access_token_authorization_code_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_access_token_authorization_code_id_idx ON public.oauth_access_token USING btree (authorization_code_id);


--
-- Name: oauth_access_token_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_access_token_client_id_idx ON public.oauth_access_token USING btree (client_id);


--
-- Name: oauth_access_token_refresh_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_access_token_refresh_id_idx ON public.oauth_access_token USING btree (refresh_id);


--
-- Name: oauth_access_token_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_access_token_session_id_idx ON public.oauth_access_token USING btree (session_id);


--
-- Name: oauth_access_token_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_access_token_user_id_idx ON public.oauth_access_token USING btree (user_id);


--
-- Name: oauth_client_resource_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_client_resource_client_id_idx ON public.oauth_client_resource USING btree (client_id);


--
-- Name: oauth_client_resource_client_id_resource_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX oauth_client_resource_client_id_resource_id_idx ON public.oauth_client_resource USING btree (client_id, resource_id);


--
-- Name: oauth_client_resource_resource_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_client_resource_resource_id_idx ON public.oauth_client_resource USING btree (resource_id);


--
-- Name: oauth_client_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_client_user_id_idx ON public.oauth_client USING btree (user_id);


--
-- Name: oauth_consent_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_consent_client_id_idx ON public.oauth_consent USING btree (client_id);


--
-- Name: oauth_consent_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_consent_user_id_idx ON public.oauth_consent USING btree (user_id);


--
-- Name: oauth_refresh_token_authorization_code_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_refresh_token_authorization_code_id_idx ON public.oauth_refresh_token USING btree (authorization_code_id);


--
-- Name: oauth_refresh_token_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_refresh_token_client_id_idx ON public.oauth_refresh_token USING btree (client_id);


--
-- Name: oauth_refresh_token_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_refresh_token_session_id_idx ON public.oauth_refresh_token USING btree (session_id);


--
-- Name: oauth_refresh_token_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_refresh_token_user_id_idx ON public.oauth_refresh_token USING btree (user_id);


--
-- Name: session_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_expiry_idx ON public.session USING btree (expires_at);


--
-- Name: session_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_user_idx ON public.session USING btree (user_id);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: account account_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: conversation conversation_direct_user_high_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation
    ADD CONSTRAINT conversation_direct_user_high_id_user_id_fk FOREIGN KEY (direct_user_high_id) REFERENCES public."user"(id) ON DELETE RESTRICT;


--
-- Name: conversation conversation_direct_user_low_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation
    ADD CONSTRAINT conversation_direct_user_low_id_user_id_fk FOREIGN KEY (direct_user_low_id) REFERENCES public."user"(id) ON DELETE RESTRICT;


--
-- Name: message message_conversation_id_conversation_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_conversation_id_conversation_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversation(id) ON DELETE RESTRICT;


--
-- Name: message_outbox message_outbox_message_id_message_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_outbox
    ADD CONSTRAINT message_outbox_message_id_message_id_fk FOREIGN KEY (message_id) REFERENCES public.message(id) ON DELETE CASCADE;


--
-- Name: message message_sender_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message
    ADD CONSTRAINT message_sender_id_user_id_fk FOREIGN KEY (sender_id) REFERENCES public."user"(id) ON DELETE RESTRICT;


--
-- Name: oauth_access_token oauth_access_token_client_id_oauth_client_client_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_client_id_oauth_client_client_id_fk FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_access_token oauth_access_token_refresh_id_oauth_refresh_token_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_refresh_id_oauth_refresh_token_id_fk FOREIGN KEY (refresh_id) REFERENCES public.oauth_refresh_token(id) ON DELETE CASCADE;


--
-- Name: oauth_access_token oauth_access_token_session_id_session_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES public.session(id) ON DELETE SET NULL;


--
-- Name: oauth_access_token oauth_access_token_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_access_token
    ADD CONSTRAINT oauth_access_token_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: oauth_client_resource oauth_client_resource_client_id_oauth_client_client_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client_resource
    ADD CONSTRAINT oauth_client_resource_client_id_oauth_client_client_id_fk FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_client_resource oauth_client_resource_resource_id_oauth_resource_identifier_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client_resource
    ADD CONSTRAINT oauth_client_resource_resource_id_oauth_resource_identifier_fk FOREIGN KEY (resource_id) REFERENCES public.oauth_resource(identifier) ON DELETE CASCADE;


--
-- Name: oauth_client oauth_client_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_client
    ADD CONSTRAINT oauth_client_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: oauth_consent oauth_consent_client_id_oauth_client_client_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_consent
    ADD CONSTRAINT oauth_consent_client_id_oauth_client_client_id_fk FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_consent oauth_consent_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_consent
    ADD CONSTRAINT oauth_consent_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: oauth_refresh_token oauth_refresh_token_client_id_oauth_client_client_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_client_id_oauth_client_client_id_fk FOREIGN KEY (client_id) REFERENCES public.oauth_client(client_id) ON DELETE CASCADE;


--
-- Name: oauth_refresh_token oauth_refresh_token_session_id_session_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_session_id_session_id_fk FOREIGN KEY (session_id) REFERENCES public.session(id) ON DELETE SET NULL;


--
-- Name: oauth_refresh_token oauth_refresh_token_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_token
    ADD CONSTRAINT oauth_refresh_token_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


