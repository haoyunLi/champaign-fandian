ALTER TABLE `visitor_preferences` ADD `nickname_key` text;--> statement-breakpoint
ALTER TABLE `visitor_preferences` ADD `revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Profile names are live labels; original order payloads remain intact for retries.
-- Triggers make propagation and nickname-conflict rollback atomic with every writer.
CREATE TRIGGER profile_insert_names AFTER INSERT ON visitor_preferences BEGIN
  UPDATE votes SET nickname=NEW.nickname,nickname_key=COALESCE(NEW.nickname_key,lower(NEW.nickname)) WHERE voter=NEW.owner;
  UPDATE orders SET revision=revision+1 WHERE (owner=NEW.owner AND nickname<>NEW.nickname)
    OR (claimant=NEW.owner AND claimant_name<>NEW.nickname);
  UPDATE rooms SET revision=revision+1 WHERE owner=NEW.owner
    OR id IN (SELECT room_id FROM votes WHERE voter=NEW.owner)
    OR id IN (SELECT room_id FROM orders WHERE owner=NEW.owner OR claimant=NEW.owner);
END;
--> statement-breakpoint
CREATE TRIGGER profile_update_names AFTER UPDATE OF nickname ON visitor_preferences
WHEN NEW.nickname<>OLD.nickname BEGIN
  UPDATE votes SET nickname=NEW.nickname,nickname_key=COALESCE(NEW.nickname_key,lower(NEW.nickname)) WHERE voter=NEW.owner;
  UPDATE orders SET revision=revision+1 WHERE owner=NEW.owner OR claimant=NEW.owner;
  UPDATE rooms SET revision=revision+1 WHERE owner=NEW.owner
    OR id IN (SELECT room_id FROM votes WHERE voter=NEW.owner)
    OR id IN (SELECT room_id FROM orders WHERE owner=NEW.owner OR claimant=NEW.owner);
END;
