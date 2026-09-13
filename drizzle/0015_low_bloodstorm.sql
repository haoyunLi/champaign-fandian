CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`room_id` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_owner_id` ON `notifications` (`owner`,`id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `purchase_status` text DEFAULT 'unplaced' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `issue_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `change_request` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `voting_deadline_at` text;
--> statement-breakpoint
CREATE TRIGGER order_progress_notice AFTER UPDATE OF status,claimant,purchase_status,change_request,dish,quantity,note ON orders
WHEN OLD.status IS NOT NEW.status OR OLD.claimant IS NOT NEW.claimant OR OLD.purchase_status IS NOT NEW.purchase_status OR OLD.change_request IS NOT NEW.change_request
BEGIN
  INSERT INTO notifications(owner,room_id,message,created_at) VALUES(NEW.owner,NEW.room_id,
    CASE
      WHEN NEW.status='delivered' THEN NEW.dish || '：' || COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=NEW.claimant),NEW.claimant_name,'带饭人') || ' 已带回，请取餐。'
      WHEN NEW.status='pending' THEN NEW.dish || '：认领已取消，正在等待其他人帮带。'
      WHEN NEW.change_request IS NOT NULL AND OLD.change_request IS NOT NEW.change_request THEN NEW.dish || '：改单申请已提交，等待带饭人确认。'
      WHEN OLD.change_request IS NOT NULL AND NEW.change_request IS NULL THEN CASE WHEN NEW.dish<>OLD.dish OR NEW.quantity<>OLD.quantity OR NEW.note<>OLD.note THEN '带饭人已同意改为 ' || NEW.dish || ' × ' || NEW.quantity || '，待重新确认下单。' ELSE NEW.dish || '：带饭人未接受改单，请联系确认。' END
      WHEN NEW.purchase_status='sold_out' THEN NEW.dish || '：菜品售罄／需要换菜。' || NEW.issue_note
      WHEN NEW.purchase_status='ordered' THEN NEW.dish || '：' || COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=NEW.claimant),NEW.claimant_name,'带饭人') || ' 已下单。'
      ELSE NEW.dish || '：' || COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=NEW.claimant),NEW.claimant_name,'带饭人') || ' 已认领。'
    END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  INSERT INTO notifications(owner,room_id,message,created_at)
    SELECT NEW.claimant,NEW.room_id,COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=NEW.owner),NEW.nickname) || ' 申请修改 ' || NEW.dish || '，请核对后确认。',strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE NEW.claimant IS NOT NULL AND NEW.claimant<>NEW.owner AND NEW.change_request IS NOT NULL AND OLD.change_request IS NOT NEW.change_request;
END;
--> statement-breakpoint
CREATE TRIGGER pickup_first_notice AFTER INSERT ON pickup_plans
BEGIN
  INSERT INTO notifications(owner,room_id,message,created_at)
    SELECT DISTINCT o.owner,NEW.room_id,COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=NEW.owner),o.claimant_name,'带饭人') || ' 更新取餐安排：' || CASE WHEN NEW.time='' THEN '时间待确认' ELSE NEW.time || '（香槟时间）' END || ' · ' || CASE WHEN NEW.place='' THEN '地点待确认' ELSE NEW.place END,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM orders o WHERE o.room_id=NEW.room_id AND o.claimant=NEW.owner AND o.status='claimed';
END;
--> statement-breakpoint
CREATE TRIGGER pickup_changed_notice AFTER UPDATE OF time,place ON pickup_plans
WHEN OLD.time<>NEW.time OR OLD.place<>NEW.place
BEGIN
  INSERT INTO notifications(owner,room_id,message,created_at)
    SELECT DISTINCT o.owner,NEW.room_id,COALESCE((SELECT nickname FROM visitor_preferences WHERE owner=NEW.owner),o.claimant_name,'带饭人') || ' 更新取餐安排：' || CASE WHEN NEW.time='' THEN '时间待确认' ELSE NEW.time || '（香槟时间）' END || ' · ' || CASE WHEN NEW.place='' THEN '地点待确认' ELSE NEW.place END,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM orders o WHERE o.room_id=NEW.room_id AND o.claimant=NEW.owner AND o.status='claimed';
END;
