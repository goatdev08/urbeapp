export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          grace_period_until: string
          id: string
          reason: Database["public"]["Enums"]["deletion_request_reason"]
          reason_text: string | null
          requested_at: string
          status: Database["public"]["Enums"]["deletion_request_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          grace_period_until: string
          id?: string
          reason: Database["public"]["Enums"]["deletion_request_reason"]
          reason_text?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_request_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          grace_period_until?: string
          id?: string
          reason?: Database["public"]["Enums"]["deletion_request_reason"]
          reason_text?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["deletion_request_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_creatives: {
        Row: {
          agency_id: string
          cloudflare_uid: string | null
          created_at: string
          duration_seconds: number | null
          failure_reason: string | null
          id: string
          status: Database["public"]["Enums"]["ad_creative_status"]
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          agency_id: string
          cloudflare_uid?: string | null
          created_at?: string
          duration_seconds?: number | null
          failure_reason?: string | null
          id?: string
          status?: Database["public"]["Enums"]["ad_creative_status"]
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          agency_id?: string
          cloudflare_uid?: string | null
          created_at?: string
          duration_seconds?: number | null
          failure_reason?: string | null
          id?: string
          status?: Database["public"]["Enums"]["ad_creative_status"]
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_impressions: {
        Row: {
          ad_id: string
          agency_id: string
          completed: boolean
          created_at: string
          cta_tapped_at: string | null
          device: string | null
          id: string
          municipality_id: string | null
          neighborhood_id: number | null
          session_id: string
          shown_at: string
          user_id: string
          viewed: boolean
          watched_ms: number
        }
        Insert: {
          ad_id: string
          agency_id: string
          completed: boolean
          created_at?: string
          cta_tapped_at?: string | null
          device?: string | null
          id: string
          municipality_id?: string | null
          neighborhood_id?: number | null
          session_id: string
          shown_at: string
          user_id: string
          viewed: boolean
          watched_ms: number
        }
        Update: {
          ad_id?: string
          agency_id?: string
          completed?: boolean
          created_at?: string
          cta_tapped_at?: string | null
          device?: string | null
          id?: string
          municipality_id?: string | null
          neighborhood_id?: number | null
          session_id?: string
          shown_at?: string
          user_id?: string
          viewed?: boolean
          watched_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "ad_impressions_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_impressions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_impressions_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "mx_neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_impressions_monthly: {
        Row: {
          ad_id: string
          agency_id: string
          completions: number
          cta_taps: number
          impressions: number
          municipality_id: string | null
          neighborhood_id: number | null
          views: number
          year_month: string
        }
        Insert: {
          ad_id: string
          agency_id: string
          completions?: number
          cta_taps?: number
          impressions?: number
          municipality_id?: string | null
          neighborhood_id?: number | null
          views?: number
          year_month: string
        }
        Update: {
          ad_id?: string
          agency_id?: string
          completions?: number
          cta_taps?: number
          impressions?: number
          municipality_id?: string | null
          neighborhood_id?: number | null
          views?: number
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_impressions_monthly_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_impressions_monthly_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_impressions_monthly_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "mx_neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_prices: {
        Row: {
          amount_mxn: number
          created_at: string
          currency: string
          days: number
          id: string
          scope: Database["public"]["Enums"]["ad_zone_scope"]
          valid_from: string
        }
        Insert: {
          amount_mxn: number
          created_at?: string
          currency?: string
          days: number
          id?: string
          scope: Database["public"]["Enums"]["ad_zone_scope"]
          valid_from?: string
        }
        Update: {
          amount_mxn?: number
          created_at?: string
          currency?: string
          days?: number
          id?: string
          scope?: Database["public"]["Enums"]["ad_zone_scope"]
          valid_from?: string
        }
        Relationships: []
      }
      ad_zones: {
        Row: {
          ad_id: string
          created_at: string
          id: string
          municipality_id: string | null
          neighborhood_id: number | null
        }
        Insert: {
          ad_id: string
          created_at?: string
          id?: string
          municipality_id?: string | null
          neighborhood_id?: number | null
        }
        Update: {
          ad_id?: string
          created_at?: string
          id?: string
          municipality_id?: string | null
          neighborhood_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_zones_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_zones_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "mx_municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_zones_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "mx_neighborhoods"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_actions: {
        Row: {
          action_type: string
          admin_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          reason: string | null
        }
        Insert: {
          action_type: string
          admin_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
        }
        Update: {
          action_type?: string
          admin_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          agency_id: string
          created_at: string
          created_by_user_id: string | null
          creative_id: string
          cta_type: Database["public"]["Enums"]["ad_cta_type"]
          cta_value: string
          description: string | null
          ends_at: string
          id: string
          paused_at: string | null
          paused_by_suspension: boolean
          purchase_id: string | null
          rejection_reason: string | null
          starts_at: string
          status: Database["public"]["Enums"]["ad_status"]
          title: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by_user_id?: string | null
          creative_id: string
          cta_type: Database["public"]["Enums"]["ad_cta_type"]
          cta_value: string
          description?: string | null
          ends_at: string
          id?: string
          paused_at?: string | null
          paused_by_suspension?: boolean
          purchase_id?: string | null
          rejection_reason?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["ad_status"]
          title: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by_user_id?: string | null
          creative_id?: string
          cta_type?: Database["public"]["Enums"]["ad_cta_type"]
          cta_value?: string
          description?: string | null
          ends_at?: string
          id?: string
          paused_at?: string | null
          paused_by_suspension?: boolean
          purchase_id?: string | null
          rejection_reason?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["ad_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "ad_creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          advertiser_category:
            | Database["public"]["Enums"]["advertiser_category"]
            | null
          approved_by_admin_id: string | null
          can_advertise: boolean
          can_publish_properties: boolean
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by_user_id: string
          deleted_at: string | null
          id: string
          logo_url: string | null
          name: string
          slug: string
          status: Database["public"]["Enums"]["agency_status"]
          updated_at: string
        }
        Insert: {
          advertiser_category?:
            | Database["public"]["Enums"]["advertiser_category"]
            | null
          approved_by_admin_id?: string | null
          can_advertise?: boolean
          can_publish_properties?: boolean
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by_user_id: string
          deleted_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          status?: Database["public"]["Enums"]["agency_status"]
          updated_at?: string
        }
        Update: {
          advertiser_category?:
            | Database["public"]["Enums"]["advertiser_category"]
            | null
          approved_by_admin_id?: string | null
          can_advertise?: boolean
          can_publish_properties?: boolean
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by_user_id?: string
          deleted_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["agency_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agencies_approved_by_admin_id_fkey"
            columns: ["approved_by_admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agencies_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_invitation_tokens: {
        Row: {
          agency_id: string
          created_at: string
          created_by_user_id: string
          current_uses: number
          expires_at: string | null
          id: string
          max_uses: number | null
          revoked_at: string | null
          target_email: string | null
          token: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by_user_id: string
          current_uses?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          target_email?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by_user_id?: string
          current_uses?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          target_email?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_invitation_tokens_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_invitation_tokens_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_members: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          invitation_token_id: string | null
          joined_at: string
          member_role: Database["public"]["Enums"]["agency_member_role"]
          removed_at: string | null
          status: Database["public"]["Enums"]["agency_member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          invitation_token_id?: string | null
          joined_at?: string
          member_role?: Database["public"]["Enums"]["agency_member_role"]
          removed_at?: string | null
          status?: Database["public"]["Enums"]["agency_member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          invitation_token_id?: string | null
          joined_at?: string
          member_role?: Database["public"]["Enums"]["agency_member_role"]
          removed_at?: string | null
          status?: Database["public"]["Enums"]["agency_member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_members_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_members_invitation_token_id_fkey"
            columns: ["invitation_token_id"]
            isOneToOne: false
            referencedRelation: "agency_invitation_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agency_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_applications: {
        Row: {
          agency_id: string | null
          application_type: Database["public"]["Enums"]["agent_application_type"]
          created_at: string
          id: string
          invitation_token_id: string | null
          reason: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by_admin_id: string | null
          status: Database["public"]["Enums"]["agent_application_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          application_type: Database["public"]["Enums"]["agent_application_type"]
          created_at?: string
          id?: string
          invitation_token_id?: string | null
          reason?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          status?: Database["public"]["Enums"]["agent_application_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          application_type?: Database["public"]["Enums"]["agent_application_type"]
          created_at?: string
          id?: string
          invitation_token_id?: string | null
          reason?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          status?: Database["public"]["Enums"]["agent_application_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_applications_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_applications_invitation_token_id_fkey"
            columns: ["invitation_token_id"]
            isOneToOne: false
            referencedRelation: "agency_invitation_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_applications_reviewed_by_admin_id_fkey"
            columns: ["reviewed_by_admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_interest_submissions: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          ip_address: unknown
          last_name: string
          phone: string
          source: Database["public"]["Enums"]["agent_interest_source"]
          status: Database["public"]["Enums"]["agent_interest_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name: string
          id?: string
          ip_address?: unknown
          last_name: string
          phone: string
          source?: Database["public"]["Enums"]["agent_interest_source"]
          status?: Database["public"]["Enums"]["agent_interest_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          ip_address?: unknown
          last_name?: string
          phone?: string
          source?: Database["public"]["Enums"]["agent_interest_source"]
          status?: Database["public"]["Enums"]["agent_interest_status"]
          updated_at?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      events_raw: {
        Row: {
          agent_id: string | null
          created_at: string
          device: string | null
          event_type: string
          id: number
          payload: Json
          property_id: string | null
          property_video_id: string | null
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          device?: string | null
          event_type: string
          id?: never
          payload?: Json
          property_id?: string | null
          property_video_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          device?: string | null
          event_type?: string
          id?: never
          payload?: Json
          property_id?: string | null
          property_video_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_raw_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_raw_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_raw_property_video_id_fkey"
            columns: ["property_video_id"]
            isOneToOne: false
            referencedRelation: "property_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_raw_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_origin_properties: {
        Row: {
          contacted_at: string
          id: string
          lead_id: string
          property_id: string
          property_video_id: string | null
        }
        Insert: {
          contacted_at?: string
          id?: string
          lead_id: string
          property_id: string
          property_video_id?: string | null
        }
        Update: {
          contacted_at?: string
          id?: string
          lead_id?: string
          property_id?: string
          property_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_origin_properties_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_origin_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_origin_properties_property_video_id_fkey"
            columns: ["property_video_id"]
            isOneToOne: false
            referencedRelation: "property_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          lead_id: string
          new_status: Database["public"]["Enums"]["lead_status"]
          old_status: Database["public"]["Enums"]["lead_status"] | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          lead_id: string
          new_status: Database["public"]["Enums"]["lead_status"]
          old_status?: Database["public"]["Enums"]["lead_status"] | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          lead_id?: string
          new_status?: Database["public"]["Enums"]["lead_status"]
          old_status?: Database["public"]["Enums"]["lead_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_status_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          agency_id: string | null
          agent_id: string
          closed_at: string | null
          created_at: string
          deleted_at: string | null
          first_contact_at: string
          id: string
          internal_notes: string | null
          is_follow_up: boolean
          last_contact_at: string | null
          level: Database["public"]["Enums"]["lead_temperature"]
          score: number
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          agent_id: string
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          first_contact_at?: string
          id?: string
          internal_notes?: string | null
          is_follow_up?: boolean
          last_contact_at?: string | null
          level?: Database["public"]["Enums"]["lead_temperature"]
          score?: number
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agency_id?: string | null
          agent_id?: string
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          first_contact_at?: string
          id?: string
          internal_notes?: string | null
          is_follow_up?: boolean
          last_contact_at?: string | null
          level?: Database["public"]["Enums"]["lead_temperature"]
          score?: number
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          created_at: string
          id: string
          property_id: string
          property_video_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          property_video_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          property_video_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_property_video_id_fkey"
            columns: ["property_video_id"]
            isOneToOne: false
            referencedRelation: "property_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mx_municipalities: {
        Row: {
          bbox_max_lat: number | null
          bbox_max_lng: number | null
          bbox_min_lat: number | null
          bbox_min_lng: number | null
          created_at: string
          id: string
          name: string
          name_normalized: string | null
          state_id: string
        }
        Insert: {
          bbox_max_lat?: number | null
          bbox_max_lng?: number | null
          bbox_min_lat?: number | null
          bbox_min_lng?: number | null
          created_at?: string
          id: string
          name: string
          name_normalized?: string | null
          state_id: string
        }
        Update: {
          bbox_max_lat?: number | null
          bbox_max_lng?: number | null
          bbox_min_lat?: number | null
          bbox_min_lng?: number | null
          created_at?: string
          id?: string
          name?: string
          name_normalized?: string | null
          state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mx_municipalities_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "mx_states"
            referencedColumns: ["id"]
          },
        ]
      }
      mx_neighborhoods: {
        Row: {
          created_at: string
          geom: unknown
          id: number
          municipality_id: string
          name: string
          name_normalized: string | null
          postal_code: string | null
          source_key: string
        }
        Insert: {
          created_at?: string
          geom: unknown
          id?: never
          municipality_id: string
          name: string
          name_normalized?: string | null
          postal_code?: string | null
          source_key: string
        }
        Update: {
          created_at?: string
          geom?: unknown
          id?: never
          municipality_id?: string
          name?: string
          name_normalized?: string | null
          postal_code?: string | null
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "mx_neighborhoods_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "mx_municipalities"
            referencedColumns: ["id"]
          },
        ]
      }
      mx_states: {
        Row: {
          abbr: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          abbr: string
          created_at?: string
          id: string
          name: string
        }
        Update: {
          abbr?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          deep_link: string | null
          deleted_at: string | null
          id: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          deep_link?: string | null
          deleted_at?: string | null
          id?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          deep_link?: string | null
          deleted_at?: string | null
          id?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          agency_id: string | null
          allows_no_guarantor: boolean
          amenities: Json
          bathrooms: number | null
          bedrooms: number | null
          built_square_meters: number | null
          city: string | null
          closed_reason:
            | Database["public"]["Enums"]["property_closed_reason"]
            | null
          contact_count: number
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          half_bathrooms: number | null
          id: string
          like_count: number
          location: unknown
          operation_type: Database["public"]["Enums"]["operation_type"]
          owner_user_id: string
          pet_friendly: boolean
          price: number
          price_visible: boolean
          property_type: Database["public"]["Enums"]["property_type"]
          published_at: string | null
          save_count: number
          slug: string | null
          social_links: Json
          square_meters: number | null
          state: string | null
          status: Database["public"]["Enums"]["property_status"]
          student_friendly: boolean
          updated_at: string
          view_count: number
          zone: string | null
        }
        Insert: {
          address: string
          agency_id?: string | null
          allows_no_guarantor?: boolean
          amenities?: Json
          bathrooms?: number | null
          bedrooms?: number | null
          built_square_meters?: number | null
          city?: string | null
          closed_reason?:
            | Database["public"]["Enums"]["property_closed_reason"]
            | null
          contact_count?: number
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          half_bathrooms?: number | null
          id?: string
          like_count?: number
          location: unknown
          operation_type: Database["public"]["Enums"]["operation_type"]
          owner_user_id: string
          pet_friendly?: boolean
          price: number
          price_visible?: boolean
          property_type: Database["public"]["Enums"]["property_type"]
          published_at?: string | null
          save_count?: number
          slug?: string | null
          social_links?: Json
          square_meters?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          student_friendly?: boolean
          updated_at?: string
          view_count?: number
          zone?: string | null
        }
        Update: {
          address?: string
          agency_id?: string | null
          allows_no_guarantor?: boolean
          amenities?: Json
          bathrooms?: number | null
          bedrooms?: number | null
          built_square_meters?: number | null
          city?: string | null
          closed_reason?:
            | Database["public"]["Enums"]["property_closed_reason"]
            | null
          contact_count?: number
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          half_bathrooms?: number | null
          id?: string
          like_count?: number
          location?: unknown
          operation_type?: Database["public"]["Enums"]["operation_type"]
          owner_user_id?: string
          pet_friendly?: boolean
          price?: number
          price_visible?: boolean
          property_type?: Database["public"]["Enums"]["property_type"]
          published_at?: string | null
          save_count?: number
          slug?: string | null
          social_links?: Json
          square_meters?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          student_friendly?: boolean
          updated_at?: string
          view_count?: number
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      property_reports: {
        Row: {
          created_at: string
          id: string
          property_id: string
          reason: Database["public"]["Enums"]["property_report_reason"]
          reason_text: string | null
          reported_by_user_id: string
          resolution: string | null
          reviewed_at: string | null
          reviewed_by_admin_id: string | null
          status: Database["public"]["Enums"]["property_report_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          reason: Database["public"]["Enums"]["property_report_reason"]
          reason_text?: string | null
          reported_by_user_id: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          status?: Database["public"]["Enums"]["property_report_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          reason?: Database["public"]["Enums"]["property_report_reason"]
          reason_text?: string | null
          reported_by_user_id?: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          status?: Database["public"]["Enums"]["property_report_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_reports_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_reports_reported_by_user_id_fkey"
            columns: ["reported_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_reports_reviewed_by_admin_id_fkey"
            columns: ["reviewed_by_admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      property_revisions: {
        Row: {
          changed_fields: Json
          created_at: string
          id: string
          property_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by_admin_id: string | null
          status: Database["public"]["Enums"]["property_revision_status"]
          submitted_by: string
          updated_at: string
        }
        Insert: {
          changed_fields: Json
          created_at?: string
          id?: string
          property_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          status?: Database["public"]["Enums"]["property_revision_status"]
          submitted_by: string
          updated_at?: string
        }
        Update: {
          changed_fields?: Json
          created_at?: string
          id?: string
          property_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_admin_id?: string | null
          status?: Database["public"]["Enums"]["property_revision_status"]
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_revisions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_revisions_reviewed_by_admin_id_fkey"
            columns: ["reviewed_by_admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_revisions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      property_video_slots: {
        Row: {
          created_at: string
          id: string
          is_free: boolean
          property_id: string
          started_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_free?: boolean
          property_id: string
          started_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_free?: boolean
          property_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_video_slots_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_videos: {
        Row: {
          agent_id: string | null
          archived_at: string | null
          cloudflare_uid: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          failure_reason: string | null
          id: string
          playback_url: string | null
          position: number
          property_id: string | null
          r2_archive_key: string | null
          ready_at: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["property_video_status"]
          storage_path: string | null
          thumbnail_pct: number | null
          thumbnail_url: string | null
          tus_upload_url: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          archived_at?: string | null
          cloudflare_uid?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          failure_reason?: string | null
          id?: string
          playback_url?: string | null
          position: number
          property_id?: string | null
          r2_archive_key?: string | null
          ready_at?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["property_video_status"]
          storage_path?: string | null
          thumbnail_pct?: number | null
          thumbnail_url?: string | null
          tus_upload_url?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          archived_at?: string | null
          cloudflare_uid?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          failure_reason?: string | null
          id?: string
          playback_url?: string | null
          position?: number
          property_id?: string | null
          r2_archive_key?: string | null
          ready_at?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["property_video_status"]
          storage_path?: string | null
          thumbnail_pct?: number | null
          thumbnail_url?: string | null
          tus_upload_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_videos_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_videos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      saves: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saves_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_versions: {
        Row: {
          content: string
          created_at: string
          doc_type: Database["public"]["Enums"]["doc_type"]
          effective_from: string
          id: string
          is_current: boolean
          version: string
        }
        Insert: {
          content: string
          created_at?: string
          doc_type: Database["public"]["Enums"]["doc_type"]
          effective_from?: string
          id?: string
          is_current?: boolean
          version: string
        }
        Update: {
          content?: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["doc_type"]
          effective_from?: string
          id?: string
          is_current?: boolean
          version?: string
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          accepted_at: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          created_at: string
          id: string
          ip_address: unknown
          terms_version_id: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          consent_type: Database["public"]["Enums"]["consent_type"]
          created_at?: string
          id?: string
          ip_address?: unknown
          terms_version_id?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          consent_type?: Database["public"]["Enums"]["consent_type"]
          created_at?: string
          id?: string
          ip_address?: unknown
          terms_version_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_terms_version_id_fkey"
            columns: ["terms_version_id"]
            isOneToOne: false
            referencedRelation: "terms_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          bathrooms_min: number | null
          bedrooms_min: number | null
          budget_max: number | null
          budget_min: number | null
          created_at: string
          full_name: string | null
          id: string
          location: unknown
          location_radius_km: number
          onboarding_completed_at: string | null
          profile_photo_url: string | null
          search_operation_type:
            | Database["public"]["Enums"]["operation_type"]
            | null
          search_property_types: Database["public"]["Enums"]["property_type"][]
          updated_at: string
          user_id: string
        }
        Insert: {
          bathrooms_min?: number | null
          bedrooms_min?: number | null
          budget_max?: number | null
          budget_min?: number | null
          created_at?: string
          full_name?: string | null
          id?: string
          location?: unknown
          location_radius_km?: number
          onboarding_completed_at?: string | null
          profile_photo_url?: string | null
          search_operation_type?:
            | Database["public"]["Enums"]["operation_type"]
            | null
          search_property_types?: Database["public"]["Enums"]["property_type"][]
          updated_at?: string
          user_id: string
        }
        Update: {
          bathrooms_min?: number | null
          bedrooms_min?: number | null
          budget_max?: number | null
          budget_min?: number | null
          created_at?: string
          full_name?: string | null
          id?: string
          location?: unknown
          location_radius_km?: number
          onboarding_completed_at?: string | null
          profile_photo_url?: string | null
          search_operation_type?:
            | Database["public"]["Enums"]["operation_type"]
            | null
          search_property_types?: Database["public"]["Enums"]["property_type"][]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          agency_id: string | null
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          deletion_pending_at: string | null
          email: string
          first_name: string | null
          id: string
          is_verified_agent: boolean
          last_login_at: string | null
          last_name: string | null
          municipality_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          state: string | null
          state_id: string | null
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          deletion_pending_at?: string | null
          email: string
          first_name?: string | null
          id: string
          is_verified_agent?: boolean
          last_login_at?: string | null
          last_name?: string | null
          municipality_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          state?: string | null
          state_id?: string | null
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          deletion_pending_at?: string | null
          email?: string
          first_name?: string | null
          id?: string
          is_verified_agent?: boolean
          last_login_at?: string | null
          last_name?: string | null
          municipality_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          state?: string | null
          state_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_municipality_id_fkey"
            columns: ["municipality_id"]
            isOneToOne: false
            referencedRelation: "mx_municipalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "mx_states"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agent_public_profiles: {
        Row: {
          full_name: string | null
          profile_photo_url: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_create_agency_atomic: {
        Args: {
          p_advertiser_category?: Database["public"]["Enums"]["advertiser_category"]
          p_can_advertise?: boolean
          p_can_publish_properties?: boolean
          p_contact_email: string
          p_contact_name: string
          p_contact_phone: string
          p_created_by_user_id: string
          p_name: string
          p_owner_user_id?: string
          p_slug: string
          p_token_hash?: string
          p_token_max_uses?: number
        }
        Returns: {
          agency_id: string
          agency_member_id: string
          token_id: string
        }[]
      }
      ads_feed_config: {
        Args: never
        Returns: {
          ad_frequency_n: number
          ad_max_per_session: number
          ads_enabled: boolean
        }[]
      }
      ads_for_zone: {
        Args: {
          p_lat: number
          p_lng: number
          p_municipality_id?: string
          p_neighborhood_id?: number
        }
        Returns: {
          agency_logo_url: string
          agency_name: string
          cloudflare_uid: string
          creative_id: string
          cta_type: Database["public"]["Enums"]["ad_cta_type"]
          cta_value: string
          description: string
          id: string
          title: string
        }[]
      }
      create_ad_campaign_atomic: {
        Args: {
          p_creative_id: string
          p_cta_type: Database["public"]["Enums"]["ad_cta_type"]
          p_cta_value: string
          p_days?: number
          p_description?: string
          p_title: string
          p_zones?: Json
        }
        Returns: string
      }
      get_lead_stats: {
        Args: { p_lead_ids: string[] }
        Returns: {
          guardo: boolean
          lead_id: string
          ultima_actividad: string
          veces_visto: number
          vio_completo: boolean
        }[]
      }
      get_neighborhood_geojson: {
        Args: { p_neighborhood_id: number }
        Returns: {
          geojson: string
          id: number
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
          name: string
        }[]
      }
      grant_ad_slot_atomic: {
        Args: {
          p_agency_id: string
          p_creative_id: string
          p_cta_type: Database["public"]["Enums"]["ad_cta_type"]
          p_cta_value: string
          p_days?: number
          p_title: string
          p_zones: Json
        }
        Returns: string
      }
      import_neighborhoods_batch: {
        Args: { p_rows: Json }
        Returns: {
          inserted: number
          skipped: number
        }[]
      }
      moderate_property_atomic: {
        Args: {
          p_action_type: string
          p_admin_id: string
          p_changed_fields?: Json
          p_new_property_status?: string
          p_new_values: Json
          p_old_values: Json
          p_property_id: string
          p_reason?: string
          p_revision_id?: string
          p_revision_reason?: string
          p_revision_status?: string
        }
        Returns: undefined
      }
      org_can_advertise: { Args: { p_agency_id: string }; Returns: boolean }
      pending_legal_consents: {
        Args: never
        Returns: {
          doc_type: string
          terms_version_id: string
          version: string
        }[]
      }
      properties_within_neighborhood: {
        Args: { p_neighborhood_id: number }
        Returns: {
          id: string
        }[]
      }
      properties_within_radius: {
        Args: { p_lat: number; p_lng: number; p_radius_m: number }
        Returns: {
          distance_m: number
          id: string
        }[]
      }
      publish_property_atomic: {
        Args: {
          p_address?: string
          p_allows_no_guarantor?: boolean
          p_bathrooms?: number
          p_bedrooms?: number
          p_built_square_meters?: number
          p_cloudflare_uid?: string
          p_currency?: string
          p_description?: string
          p_half_bathrooms?: number
          p_lat?: number
          p_lng?: number
          p_operation_type: string
          p_pet_friendly?: boolean
          p_price: number
          p_price_visible?: boolean
          p_property_status?: string
          p_property_type: string
          p_square_meters?: number
          p_student_friendly?: boolean
          p_user_id: string
        }
        Returns: {
          property_id: string
        }[]
      }
      purge_ad_impressions: { Args: never; Returns: undefined }
      redeem_invitation_atomic: {
        Args: { p_ip?: unknown; p_token_id: string; p_user_id: string }
        Returns: {
          agency_id: string
          agency_member_id: string
        }[]
      }
      register_agency_atomic: {
        Args: {
          p_contact_email: string
          p_contact_name: string
          p_contact_phone: string
          p_created_by_user_id: string
          p_logo_url?: string
          p_name: string
          p_slug: string
        }
        Returns: string
      }
      register_user_atomic: {
        Args: { p_ip?: unknown; p_user_id: string }
        Returns: undefined
      }
      resolve_ad_zone: {
        Args: { p_lat: number; p_lng: number }
        Returns: {
          municipality_id: string
          neighborhood_id: number
        }[]
      }
      search_places: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          context: string
          id: string
          kind: string
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
          name: string
        }[]
      }
      set_org_advertising_atomic: {
        Args: {
          p_agency_id: string
          p_category?: Database["public"]["Enums"]["advertiser_category"]
          p_enabled: boolean
        }
        Returns: undefined
      }
      switch_agency_atomic: {
        Args: { p_target_agency_id: string; p_user_id: string }
        Returns: {
          agency_member_id: string
          new_agency_id: string
          old_agency_id: string
        }[]
      }
      upgrade_to_agent_atomic: {
        Args: { p_token: string; p_user_id: string }
        Returns: {
          agency_id: string
          agency_member_id: string
        }[]
      }
    }
    Enums: {
      ad_creative_status: "uploading" | "processing" | "ready" | "failed"
      ad_cta_type: "external_url" | "whatsapp" | "phone"
      ad_status:
        | "draft"
        | "pending_review"
        | "active"
        | "paused"
        | "expired"
        | "rejected"
      ad_zone_scope: "neighborhood" | "municipality" | "national"
      advertiser_category:
        | "credito_hipotecario"
        | "seguros"
        | "mudanzas"
        | "limpieza"
        | "notaria"
        | "avaluos"
        | "otro"
      agency_member_role: "owner" | "agent" | "admin" | "viewer"
      agency_member_status: "active" | "removed" | "suspended"
      agency_status:
        | "pending_approval"
        | "approved"
        | "active"
        | "suspended"
        | "rejected"
      agent_application_status: "pending" | "approved" | "rejected"
      agent_application_type: "independent" | "under_agency"
      agent_interest_source: "landing" | "app"
      agent_interest_status: "new" | "contacted" | "archived"
      consent_type: "terms" | "privacy" | "age" | "whatsapp"
      deletion_request_reason:
        | "not_useful"
        | "privacy_concern"
        | "duplicate_account"
        | "too_many_notifications"
        | "other"
      deletion_request_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
      doc_type: "terms" | "privacy"
      lead_status:
        | "new"
        | "contacted"
        | "in_progress"
        | "visit_scheduled"
        | "closed_won"
        | "closed_lost"
        | "discarded"
        | "whatsapp_opened"
        | "interested"
        | "closed_won_rent"
        | "closed_won_sale"
      lead_temperature: "frio" | "tibio" | "caliente"
      operation_type: "rent" | "sale" | "both"
      property_closed_reason: "rented" | "sold" | "withdrawn" | "expired"
      property_report_reason:
        | "not_exist_fraud"
        | "misleading"
        | "false_price"
        | "wrong_address"
        | "inappropriate"
        | "duplicate"
        | "other"
      property_report_status: "new" | "reviewing" | "resolved" | "dismissed"
      property_revision_status:
        | "pending"
        | "needs_changes"
        | "rejected"
        | "approved"
      property_status:
        | "draft"
        | "pending_review"
        | "needs_changes"
        | "active"
        | "paused"
        | "closed"
        | "suspended"
        | "uploading_media"
        | "media_failed"
        | "pending_payment"
        | "approved"
        | "expired"
        | "rented"
        | "sold"
        | "rejected"
        | "deleted_soft"
        | "deleted_hard"
      property_type: "casa" | "departamento" | "local" | "oficina" | "terreno"
      property_video_status:
        | "uploading"
        | "processing"
        | "ready"
        | "failed"
        | "archived"
      user_role: "user" | "agent" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ad_creative_status: ["uploading", "processing", "ready", "failed"],
      ad_cta_type: ["external_url", "whatsapp", "phone"],
      ad_status: [
        "draft",
        "pending_review",
        "active",
        "paused",
        "expired",
        "rejected",
      ],
      ad_zone_scope: ["neighborhood", "municipality", "national"],
      advertiser_category: [
        "credito_hipotecario",
        "seguros",
        "mudanzas",
        "limpieza",
        "notaria",
        "avaluos",
        "otro",
      ],
      agency_member_role: ["owner", "agent", "admin", "viewer"],
      agency_member_status: ["active", "removed", "suspended"],
      agency_status: [
        "pending_approval",
        "approved",
        "active",
        "suspended",
        "rejected",
      ],
      agent_application_status: ["pending", "approved", "rejected"],
      agent_application_type: ["independent", "under_agency"],
      agent_interest_source: ["landing", "app"],
      agent_interest_status: ["new", "contacted", "archived"],
      consent_type: ["terms", "privacy", "age", "whatsapp"],
      deletion_request_reason: [
        "not_useful",
        "privacy_concern",
        "duplicate_account",
        "too_many_notifications",
        "other",
      ],
      deletion_request_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
      ],
      doc_type: ["terms", "privacy"],
      lead_status: [
        "new",
        "contacted",
        "in_progress",
        "visit_scheduled",
        "closed_won",
        "closed_lost",
        "discarded",
        "whatsapp_opened",
        "interested",
        "closed_won_rent",
        "closed_won_sale",
      ],
      lead_temperature: ["frio", "tibio", "caliente"],
      operation_type: ["rent", "sale", "both"],
      property_closed_reason: ["rented", "sold", "withdrawn", "expired"],
      property_report_reason: [
        "not_exist_fraud",
        "misleading",
        "false_price",
        "wrong_address",
        "inappropriate",
        "duplicate",
        "other",
      ],
      property_report_status: ["new", "reviewing", "resolved", "dismissed"],
      property_revision_status: [
        "pending",
        "needs_changes",
        "rejected",
        "approved",
      ],
      property_status: [
        "draft",
        "pending_review",
        "needs_changes",
        "active",
        "paused",
        "closed",
        "suspended",
        "uploading_media",
        "media_failed",
        "pending_payment",
        "approved",
        "expired",
        "rented",
        "sold",
        "rejected",
        "deleted_soft",
        "deleted_hard",
      ],
      property_type: ["casa", "departamento", "local", "oficina", "terreno"],
      property_video_status: [
        "uploading",
        "processing",
        "ready",
        "failed",
        "archived",
      ],
      user_role: ["user", "agent", "admin"],
    },
  },
} as const

