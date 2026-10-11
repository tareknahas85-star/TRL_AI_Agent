package app.trl.agent;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AirNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
